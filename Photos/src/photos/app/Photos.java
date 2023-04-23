package photos.app;

import java.io.IOException;
import java.util.ArrayList;

import javafx.application.Application;
import javafx.fxml.FXMLLoader;
import javafx.scene.Scene;
import javafx.scene.layout.Pane;
import javafx.stage.Stage;
import photos.controller.LoginController;
import photos.utility.*;

/**
 * Runner class for the entire program
 * @author Zihao Zheng, Yiming Huang
 * @since 4/13/23
 * */
public class Photos extends Application{
	/**Reference to the current stage we are on*/
	Stage mainStage;

	/**
	The main class of the Photos application.
	It launches the application and sets up the initial stage with the login view.
	*/
	@Override
	public void start(Stage stage) throws Exception {
		mainStage = stage;
		
		//create FXML Loader
		FXMLLoader loader = new FXMLLoader();
		loader.setLocation(getClass().getResource("/photos/view/login.fxml"));
		
		Pane root = (Pane)loader.load();
		
		LoginController controller = loader.getController();
		controller.setMainStage(mainStage);

		// initialize the data storage system
		manualAddUser();
		Privacy.init();
		
		Scene scene = new Scene(root);
		mainStage.setTitle("Photos");
		mainStage.setScene(scene);
		mainStage.setResizable(false);
		mainStage.show();	
	}
	
	/**
	This is the entry point of the application.
	@param args the command line arguments
	*/
	public static void main(String[] args) {
		// TODO Auto-generated method stub
		launch(args);
	}
	
	/**
	Adds user data to the data storage system manually.
	This method is used to manually add user data to the data storage system. It contains
	a commented-out block of code that appends user data to the Privacy.users array list
	and then serializes it to the disk. However, this block of code is commented out as
	it is a "DANGER ZONE" that resets everything to default, so it should not be uncommented
	without caution.
	@throws IOException if there is an input/output error while reading or writing data
	*/
	public void manualAddUser() throws IOException {
		// DANGER ZONE do not uncomment ： it will reset everything to default!!!
		
//		String currentDir = System.getProperty("user.dir");
//        System.out.println("Current directory: " + currentDir);
        
        //append user to file
//		Privacy.users = new ArrayList<User>();
//		
//        User u1 = new User("user","user","Non-admin");
//        u1.albums = new ArrayList<Album>();
//
//        User u2 = new User("admin","admin","Administrator");
//        
//        User u3 = new User("stock","stock","Non-admin");
//        u3.albums = new ArrayList<Album>();
//        
//        Privacy.add(u1);Privacy.add(u2);Privacy.add(u3);
//		Privacy.serialize();
	}
}